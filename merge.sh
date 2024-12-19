#!/bin/bash

# Set output file
output_file="merged_modules_and_tests.txt"

# Remove output file if it exists
rm -f "$output_file"

# Function to print folder structure
print_structure() {
    echo -e "\nFolder Structure:" > "$output_file"
    tree modules tests >> "$output_file"
    echo -e "\n\n=== Begin File Contents ===\n\n" >> "$output_file"
}

# Function to append specific files if they exist
append_file_if_exists() {
    local file=$1
    if [ -f "$file" ]; then
        echo -e "\n\n=== File: $file ===\n" >> "$output_file"
        cat "$file" >> "$output_file"
        echo -e "\n--- End of $file ---\n" >> "$output_file"
    fi
}

# Print the folder structure first
print_structure

# Directories to process
directories=("modules" "tests")

# Process files folder by folder
for dir in "${directories[@]}"; do
    for folder in $(find "$dir" -type d | sort); do
        # Add folder name if it contains files
        if [ -n "$(ls -A $folder/*.js 2>/dev/null)" ]; then
            echo -e "\n\n=== Folder: $folder ===\n" >> "$output_file"
            
            # Process each .js file in the folder
            for file in $folder/*.js; do
                if [ -f "$file" ]; then
                    echo -e "\n--- File: $file ---\n" >> "$output_file"
                    cat "$file" >> "$output_file"
                    echo -e "\n--- End of $file ---\n" >> "$output_file"
                fi
            done
        fi
    done
done

# Append specific root-level files if they exist
root_files=("package.json" ".babelrc" "jest.config.js" "jest.setup.js")
for file in "${root_files[@]}"; do
    append_file_if_exists "$file"
done

echo "Files from 'modules', 'tests', and specific root-level files have been merged into $output_file"
